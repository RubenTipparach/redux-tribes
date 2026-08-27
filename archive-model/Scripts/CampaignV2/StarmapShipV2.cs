using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

//[ExecuteAlways]
public class StarmapShipV2 : MonoBehaviour
{
    [Header("Navigation")]    
    public Celestial selectedLocation;
    public Celestial travelToLocation;
    public Celestial atLocation;


    //RectTransform rectTransform => (RectTransform)transform;
    [Header("Move Animations")]
    public Vector3 starOffset;

    public Timing travelTime;
    public bool traveling = false;

    public Transform currentSpot;
    public Transform nextSpot;

    public float travelSpeed = 4f;
    public float interStellarTravelSpeed = 20f;


    [Header("Scaliing Controls")]
    public AnimationCurve NlipsScaling;
    public float maxScale = 4;
    public Transform shipModel;

    public string guid;

    // Start is called before the first frame update
    void Start()
    {
        travelTime.Init();
        //CampaignMenu.Instance.navigationPanel.starmapGenerator.SetHighlightStars(selectedStar.rectTransform);

        if(atLocation != null)
        {
            // if -1 is returned, we cant dock, default to 1
            SetLocation(atLocation);
        }

    }

    public void SetLocation(Celestial location)
    {
        atLocation = location;
        var dockIndex = atLocation.EnterDockingSpot(this.gameObject);
        Debug.Log($"forcing ship at location {atLocation.LocationName}");
        Debug.Log(dockIndex.gameObject.name);
        transform.position = dockIndex.position;
        currentSpot = dockIndex;
    }

    public void UpdateScale(float scaleRatio)
    {
        float interpretadScale = NlipsScaling.Evaluate(scaleRatio);
        float newScale = 1 + interpretadScale * maxScale;
        shipModel.localScale = Vector3.one * newScale;
    }

    public void MoveToNextStar()
    {
        // Debug.Log($"star stats: faction str = {selectedStar.factionStatus.factionScore} " + 
        //         $"IS_HOSTILE = {selectedStar.IS_HOSTILE} " +
        //         $"IS_VERY_HOSTILE = {selectedStar.IS_VERY_HOSTILE}" );
        // if ((selectedStar.IS_HOSTILE || selectedStar.IS_VERY_HOSTILE)
        //     &&
        //     selectedStar.garrisonStrength >= 2)
        // {

        //     CampaignMenu.Instance.TriggerWarning(WarningType.BLOCKADE_PREVENTING_TRANSIT);
        // }
        // else
        // {
        //     //Debug.Log("can move");
        //     //travelToStar = CampaignMenu.Instance.navigationPanel.starmapGenerator.selectedStar;
        //     //CampaignMenu.Instance.navigationPanel.travelButton.interactable = false;
        //     //CampaignMenu.Instance.navigationPanel.starmapGenerator.SetSelectedLine(selectedStar.rectTransform, travelToStar.rectTransform);
        // }
        travelToLocation = selectedLocation;

        var distanceV = nextSpot.position - currentSpot.position;
        if (travelToLocation.system != atLocation.system)
        {
            travelTime.duration = distanceV.magnitude / interStellarTravelSpeed;
        }
        else
        {
            travelTime.duration = distanceV.magnitude / travelSpeed; // this is how long it takes to travel
        }

        atLocation.LeaveDockingSpot(this.gameObject);
        var direction = Vector3.Scale(distanceV.normalized, new Vector3(1, 0, 1));
        transform.rotation = Quaternion.LookRotation(direction);
        traveling = true;
        travelTime.Init();
    }

    // public void SetCurrentStar(string starId){

    //     Debug.Log("set ship at current "+starId);

    //     //rectTransform.position = selectedStar.rectTransform.position + starOffset; // default 20281bc4-f002-4d0f-ba85-113273d54755
    //     VerifyCurrentStar();

    // }

    // Update is called once per frame
    void Update()
    {
        // fix ship to star.
        // if(travelToStar == null)
        // {
        //     rectTransform.position = (Vector2)selectedStar.rectTransform.position + starOffset;
        // }

        // begin traveling to the next star


        // move to the next star.
        if (traveling)
        {
            transform.position = Vector3.Lerp(
                atLocation.transform.position + starOffset,
                travelToLocation.transform.position + starOffset, 
                travelTime.GetProgressClamped);
        }

        // we have arrived so stop moving lol
        if(
            travelTime.Completed() && traveling == true
        ){
            traveling = false;
            atLocation = travelToLocation;
            travelToLocation = null;

            //CampaignMenu.Instance.navigationPanel.CheckCanGoToStar();
            //CampaignMenu.Instance.navigationPanel.ClearSelection();
            //CampaignMenu.Instance.navigationPanel.SetHighlightStars(selectedStar.rectTransform);
            var gm = CampaignV2.CampaignMap.Instance;
            gm.TraveledToLocationReset();
            atLocation.EnterDockingSpot(this.gameObject);
            transform.position = nextSpot.position;
            transform.localRotation = Quaternion.identity;
            currentSpot = nextSpot;
            nextSpot = null;
            var location = gm.selectionManager.selectedObjectClick.GetComponent<Celestial>();
            if (location != null && location != gm.playerShip.atLocation)
            {
                gm.playerShip.SetDestination(location);
                var canTravel = gm.playerShip.atLocation.IsAdjacentToSolarSystem(location.system);

                Debug.Log($"can travel? {canTravel} {gm.playerShip.atLocation.system.LocationName}-->{location.system.LocationName}");
                gm.campaignMenu.SetObjectSelectedLocation(location, canTravel);
            }
            
            VerifyCurrentStar();

            // save the little shippy location:
            gm.SaveData();
        }



    }

    private void VerifyCurrentStar()
    {

        // rectTransform.position = selectedStar.rectTransform.position + starOffset;


        // if ((selectedStar.IS_HOSTILE || selectedStar.IS_VERY_HOSTILE || selectedStar.IS_NEUTRAL)
        //     &&
        //     selectedStar.garrisonStrength >= 1)
        // {
        //     CampaignMenu.Instance.navigationPanel.combatButton.interactable = true;
        // }
        // else{
        //     CampaignMenu.Instance.navigationPanel.combatButton.interactable = false;
        // }
    }

    public void SetDestination(Celestial selectedObject)
    {
        if (selectedObject == null) return;


        // if(selectedLocation != null)
        // {
        //     selectedLocation.LeaveDockingSpot(this.gameObject);
        // }
        this.selectedLocation = selectedObject;
        nextSpot = selectedObject.NextOpenSpot();//.EnterDockingSpot(this.gameObject);
    }

    // private void SetCurrentDocking()
    // {
    //     var dockIndex = atLocation.EnterDockingSpot(this.gameObject);
    //     transform.position = dockIndex.position;
    //     currentSpot = dockIndex;
    // }
}
