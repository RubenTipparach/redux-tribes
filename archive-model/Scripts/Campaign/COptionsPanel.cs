using System.Collections;
using System.Collections.Generic;
using DevLocker.Utils;
using UnityEngine;
using UnityEngine.SceneManagement;

public class COptionsPanel : MonoBehaviour, ICampaignPanel
{

    public SceneReference mainMenu;


    public void ResetCampaign()
    {
        CampaignMenu.Instance.ResetCampaignSave();
    }

    public void SaveAndQuit()
    {
        //CampaignMenu.Instance.SaveGame();
        SceneManager.LoadScene(mainMenu.ScenePath);
    }

    public void Close()
    {
        gameObject.SetActive(false);
    }

    public ICampaignPanel Open()
    {
        gameObject.SetActive(true);
        return this;
    }


    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
