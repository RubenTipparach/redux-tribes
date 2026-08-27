using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

//[ExecuteAlways]
public class StarmapShip : MonoBehaviour
{

    public StarItemUI selectedStar;
    public StarItemUI travelToStar;
    public Vector2 starOffset;

    RectTransform rectTransform => (RectTransform)transform;

    public Timing travelTime;
    public bool traveling = false;

    public PlanetItemUI atPlanet;

    // Start is called before the first frame update
    void Start()
    {
        travelTime.Init();
        //CampaignMenu.Instance.navigationPanel.starmapGenerator.SetHighlightStars(selectedStar.rectTransform);

    }

    public void MoveToNextStar(){
        // Debug.Log($"star stats: faction str = {selectedStar.factionStatus.factionScore} " + 
        //         $"IS_HOSTILE = {selectedStar.IS_HOSTILE} " +
        //         $"IS_VERY_HOSTILE = {selectedStar.IS_VERY_HOSTILE}" );
        if ((selectedStar.IS_HOSTILE || selectedStar.IS_VERY_HOSTILE)
            &&
            selectedStar.garrisonStrength >= 2)
        {
            
            CampaignMenu.Instance.TriggerWarning(WarningType.BLOCKADE_PREVENTING_TRANSIT);
        }
        else
        {
            //Debug.Log("can move");
            //travelToStar = CampaignMenu.Instance.navigationPanel.starmapGenerator.selectedStar;
            //CampaignMenu.Instance.navigationPanel.travelButton.interactable = false;
            //CampaignMenu.Instance.navigationPanel.starmapGenerator.SetSelectedLine(selectedStar.rectTransform, travelToStar.rectTransform);
        }
    }

    public void SetCurrentStar(string starId){

        Debug.Log("set ship at current "+starId);

        // var starFound = CampaignMenu.Instance.navigationPanel.findStarById(starId);
        //selectedStar = starFound;
        rectTransform.position = (Vector2)selectedStar.rectTransform.position + starOffset; // default 20281bc4-f002-4d0f-ba85-113273d54755
        VerifyCurrentStar();

    }

    // Update is called once per frame
    void Update()
    {
        // fix ship to star.
        // if(travelToStar == null)
        // {
        //     rectTransform.position = (Vector2)selectedStar.rectTransform.position + starOffset;
        // }

        // begin traveling to the next star
        if (traveling == false && travelToStar != null)
        {
            traveling = true;
            travelTime.Init();
        }

        // move to the next star.
        if (traveling)
        {
            rectTransform.position = Vector2.Lerp(
                (Vector2)selectedStar.rectTransform.position + starOffset,
                (Vector2)travelToStar.rectTransform.position + starOffset, 
                travelTime.GetProgressClamped);
        }

        // we have arrived so stop moving lol
        if(
            travelTime.Completed() && traveling == true
        ){
            traveling = false;
            selectedStar = travelToStar;
            travelToStar = null;
            // CampaignMenu.Instance.navigationPanel.starmapGenerator.CheckCanGoToStar();
            // CampaignMenu.Instance.navigationPanel.starmapGenerator.ClearSelection();
            // CampaignMenu.Instance.navigationPanel.starmapGenerator.SetHighlightStars(selectedStar.rectTransform);
            VerifyCurrentStar();
            // save the little shippy location:
            CampaignMenu.Instance.SaveGame();
        }



    }

    private void VerifyCurrentStar()
    {

            rectTransform.position = (Vector2)selectedStar.rectTransform.position + starOffset;

            // TODO: trigger arrival mechanics.
            //CampaignMenu.Instance.navigationPanel.starmapGenerator.CheckCanGoToStar();


            if ((selectedStar.IS_HOSTILE || selectedStar.IS_VERY_HOSTILE || selectedStar.IS_NEUTRAL)
                &&
                selectedStar.garrisonStrength >= 1)
            {
                //CampaignMenu.Instance.navigationPanel.combatButton.interactable = true;
            }
            else{
                //CampaignMenu.Instance.navigationPanel.combatButton.interactable = false;
            }
    }
}
