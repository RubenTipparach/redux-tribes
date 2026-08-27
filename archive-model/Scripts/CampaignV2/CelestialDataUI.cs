using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class CelestialDataUI : MonoBehaviour
{
    public Image flagImage;// todo create some pattern thingy for the planet?

    public TextMeshProUGUI planetNameText;
    public TextMeshProUGUI missionText;
    public TextMeshProUGUI fleetGroupsText;
    
    // Start is called before the first frame update
    void Start()
    {

    }

    // Update is called once per frame
    void Update()
    {

    }

    public void SetInfo(Sprite flag, string planetName, string mission, string fleetGroups)
    {
        flagImage.sprite = flag;
        planetNameText.text = planetName;
        missionText.text = mission;
        fleetGroupsText.text = fleetGroups;

    }
}
